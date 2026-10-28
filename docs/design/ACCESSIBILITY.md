# Boardloom accessibility specification

Status: T05 reference specification for WCAG 2.2 AA. No production UI or automated audit result is claimed here. T18 owns the final browser, axe and manual accessibility evidence.

## 1. Target and boundaries

The framework shell, viewer, editor, states and chart alternatives target WCAG 2.2 AA. The design is judged with:

- Keyboard-only completion of every core flow in section 4.
- Visible focus that meets contrast, is not obscured and follows a logical order.
- Accessible names, roles, states and descriptions for every interactive control.
- Dialog, drawer, popover and menu focus management.
- A text alternative and accessible data table or summary for every chart.
- Status changes announced without excessive interruption.
- No meaning carried by color alone.
- Text and non-text contrast meeting AA.
- Reflow at 320 CSS px and 200 percent zoom without loss of function.
- Target size of at least 24 by 24 CSS px unless a documented exception applies.
- Reduced motion honored, with a way to stop chart animation.

The static references show the intended structure and annotations. They are not an automated audit pass. Real browser checks, screen-reader checks and axe results belong to T18 and must be recorded with the tested build and fixture.

## 2. Semantics and landmarks

The viewer and editor use the same landmark skeleton.

| Landmark     | Element                                            | Contents                                                      |
| ------------ | -------------------------------------------------- | ------------------------------------------------------------- |
| Banner       | `header` with accessible name                      | Board identity, title, provenance, mode and top-level actions |
| Modes        | `nav` labelled by the mode control name            | Viewer/Editor mode switch and view-only actions               |
| Filters      | `search` or `form` labelled "Board filters"        | Filter strip, filter summary and reset                        |
| Board region | `main` or `region` labelled by the board title     | Board canvas and blocks                                       |
| Block        | `section` or `article` labelled by the block title | Each chart, metric, table, text or filter block               |
| Inspector    | `complementary` labelled "Block inspector"         | Editor property, layout and data panels                       |
| Status       | `status` or `log` region                           | Draft, data freshness, realtime and apply announcements       |
| Dialog       | `dialog` with `aria-modal="true"` where modal      | Filter panel, confirmation and comparison builder when modal  |
| Content info | `footer` only when host content exists             | Not required for an embedded board                            |

The skip link is the first focusable element and moves focus to the board region. It is visually hidden until focused. The host page keeps its own landmarks and direction; Boardloom does not wrap the host in its own page shell.

Embedding contract: the host document has exactly one `main` landmark. If Boardloom is the page's primary content, its board canvas may be that `main`. When Boardloom is embedded in a documentation page, dashboard or another host with an existing `main`, the board canvas is a labelled `region` instead. Reference mocks use regions so a page containing several artboards never exposes multiple main landmarks. The runtime must not create a nested `main`.

## 3. Focus order

Desktop viewer:

1. Skip to board content.
2. Board identity and title link, if the host makes it a link.
3. Viewer/Editor mode switch.
4. Primary and overflow board actions.
5. Filter strip: each active filter chip, then Filters, then Reset.
6. Diagnostics or warning summary, when present.
7. Board main: each block in document order. A block receives focus at its title or interactive chart surface, then its local actions and data table disclosure.
8. Realtime status and pause/resume.
9. Live region output, which is not in the tab order.

Desktop editor adds the block library before the canvas and the inspector after the canvas. Within the library, the search field comes first, then categories and block buttons. Within the inspector, the active tab comes first, then fields in reading order, then Apply and Discard in the sticky draft bar. The draft bar is reachable from the toolbar and from the inspector without relying on its visual position.

Narrow viewer inserts the Filters button where the strip was, and the sheet carries filter controls in the same order as the desktop strip. Narrow editor inserts Blocks and Inspect drawer triggers before the canvas; the drawer opens with focus on its heading or first control, traps focus only when modal, closes with Escape and returns focus to the trigger. A modal inspector keeps Apply and Discard in a sticky footer inside the sheet, not behind the scrim.

When a block is added, moved, resized, duplicated, deleted or reset, focus stays on the selected block or moves to the block's new title. Focus is never lost to the document body. When a panel closes after apply or cancel, focus returns to the invoking control if it still exists, otherwise to the selected block title.

## 4. Keyboard paths for core flows

Modifier notation: `Mod` is Command on macOS and Control elsewhere. Shortcuts are documented in the UI and must not override browser or assistive-technology shortcuts for common editing. Every shortcut has a visible menu or button alternative.

| Flow                       | Keyboard path                                                                                                                      | Announced result                                                              | Escape / cancellation                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Open or import a board     | Focus "Open board"; Enter; file chooser or import dialog; choose file; review validation summary; activate "Open as new board"     | Loading, validation warnings, new board name and focus on the new board title | Escape closes the dialog without creating a space or changing focus       |
| Switch viewer/editor       | Tab to mode switch; arrow keys or Enter/Space selects mode                                                                         | New mode and whether a draft is preserved                                     | Escape does not discard a draft                                           |
| Create a board             | Focus "New board"; Enter; title field; optional template; activate Create                                                          | New board created, empty-state guidance, focus on title                       | Escape closes without creating                                            |
| Select chart fields        | Focus block; open inspector; choose X, Y, series and aggregation; validation errors appear inline                                  | Field role, accepted binding and any diagnostic                               | Escape closes the picker and restores the previous value                  |
| Add block with keyboard    | Editor toolbar: Add block, or library search; choose type; activate Add                                                            | Block name, insertion position and selected state                             | Escape returns focus to the Add control without adding                    |
| Move block with keyboard   | Select block; activate "Move block"; use arrow keys in grid increments; Enter commits, Escape cancels                              | New row/column and overlap or boundary warnings                               | Escape restores the original placement                                    |
| Resize block with keyboard | Select block; activate "Resize block"; arrow keys change width/height by one column or row; Enter commits                          | New size and minimum-size or overlap warnings                                 | Escape restores the original size                                         |
| Reorder block              | Select block; use "Move earlier/later" or `Alt+Arrow` when focus is not in a text field; confirm                                   | New order and position                                                        | Escape cancels an in-progress order preview                               |
| Delete or duplicate        | Block action menu; choose Duplicate or Delete; confirm Delete                                                                      | Duplicate selected; deletion announced with Undo available                    | Escape closes the menu; deletion confirmation can cancel                  |
| Edit filter                | Focus filter chip or Filters; open editor; choose operator and value; apply                                                        | Filter scope, affected block count, query loading and settled state           | Escape cancels the edit and preserves the accepted value                  |
| Reset filter or board      | Focus Reset; choose one filter, scope, block or board; confirm                                                                     | Scope reset and restored defaults                                             | Escape closes the reset confirmation                                      |
| Cross-filter               | Focus a chart mark or legend item; activate Select; choose compatible target blocks                                                | Selection source, target count and disabled targets with reasons              | Escape or Reset clears the ephemeral selection                            |
| Configure comparison       | Editor inspector Comparison tab; choose reference dataset/slice; map fields and alignment; choose display and delta mode; validate | Mapping result, invalid targets and unavailable delta reasons                 | Escape closes the builder without changing the draft                      |
| Apply draft                | Focus Apply in draft bar; Enter                                                                                                    | Applying, applied revision, dirty state cleared and focus retained            | If validation fails, focus moves to the first error and the draft remains |
| Cancel draft               | Focus Discard; Enter; confirm if dirty                                                                                             | Draft discarded, committed revision restored                                  | Escape returns to the draft without discarding                            |
| Undo/redo                  | `Mod+Z` / `Mod+Shift+Z` or toolbar buttons                                                                                         | Change description and dirty state                                            | Not applicable                                                            |
| Pause/resume realtime      | Focus realtime status; activate Pause or Resume                                                                                    | Paused with buffered update policy, or resuming with resync if needed         | Not applicable                                                            |
| Read chart alternative     | Focus chart; open "View data table"; navigate table with arrow keys or standard table navigation                                   | Row/column position, series, value, unit and missing count                    | Escape closes the disclosure and returns focus to the chart               |

The editor layout controls are always available as buttons. Drag and resize are enhancements; a keyboard-only author can complete every structural operation. Pointer drag does not capture focus in a way that prevents Tab from reaching the keyboard alternative.

## 5. Focus and target size

- Focus uses a 2 px solid ring in `--bl-color-focus`, offset by 2 px. The ring is never removed, even on custom controls.
- Focus indicators are not clipped by `overflow: hidden`; sticky toolbars and drawers reserve space for the ring.
- Focus contrast is at least 3:1 against the adjacent canvas or surface. The measured ratios are in `DESIGN_SYSTEM.md`.
- Hover and focus are distinct. A hover style never replaces the focus indicator.
- Target size is at least 24 by 24 CSS px for pointer input, including icon buttons, chips and chart legend toggles. Primary controls are 36 or 40 px high. Spacing between targets prevents accidental activation.
- Disabled controls are removed from the tab order. If a user needs the reason, a read-only control remains focusable and explains why it cannot be changed.
- Focus order follows DOM order and logical reading direction. In RTL the visual order flips with logical properties, while the DOM and focus order remain meaningful.
- Dialogs and modal drawers trap focus, cycle in both directions, close on Escape and restore focus to the invoker. Non-modal drawers do not trap focus.
- A skip link is always the first focusable element. The board title is the first heading in the board region; a full-page host may render that region as `main`.

## 6. Accessible names, descriptions and states

- Every icon-only control has an accessible name that describes the action, for example "Remove filter: Term" or "Move block: Enrolment by grade".
- Visible labels are programmatically associated with their fields. Placeholder text is never the only label.
- Errors use `aria-invalid`, a described-by message and a danger icon plus text. The message names the field and the reason.
- Read-only fields expose their state; a disabled field that still contains useful information is avoided in favour of read-only.
- Segmented controls expose their selected state through the proper radio or pressed-state pattern.
- Tables expose header scope, sort state and selected rows. Virtualized rows preserve focus and announce row position.
- Chart series expose a text name, unit, value and missing/invalid status in the data table. A legend item has a visible name and a pattern swatch, not only a color square.
- Selection and filter origin are described in words. A chip's remove action includes the filter name and scope.
- The editor's dirty state is a visible text status and is announced through a polite live region after changes, not on every keystroke.

## 7. Live regions and announcements

Use one polite status region per view for routine status and one assertive alert region only for blocking errors that need immediate attention. Announcements are concise and deduplicated. Loading spinners do not announce repeatedly.

| Event                  | Politeness                                    | Message intent                                                |
| ---------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| Board loaded           | Polite                                        | Board name and warning count                                  |
| Query loading          | Polite, once                                  | "Loading data for 4 blocks"                                   |
| Query settled          | Polite                                        | "Data updated" plus stale or partial qualifier                |
| Empty result           | Polite                                        | "No data for the active filters"                              |
| Block error            | Assertive once                                | "Block failed to load" plus recovery action                   |
| Draft dirty            | Polite                                        | "Unsaved changes" after a structural edit, not each keystroke |
| Draft applied          | Polite                                        | "Changes applied" plus revision or conflict                   |
| Draft cancelled        | Polite                                        | "Draft discarded"                                             |
| Realtime status        | Polite                                        | "Reconnecting, attempt 2 of 10" or "Live"                     |
| Filter changed         | Polite                                        | Filter name, new value and affected block count               |
| Comparison unavailable | Polite when focus enters the panel            | Reason such as reference zero or missing key                  |
| Plugin error           | Assertive once at registration/render failure | Plugin identity, contained block and recovery                 |
| Locale changed         | Polite                                        | New locale name; focus and state preserved                    |

A live region must exist in the DOM before the message is inserted. Status text is also visible; it is never screen-reader-only. Errors that appear in a dialog are announced by the dialog's labelled description, not by a duplicate live region.

## 8. Charts and data alternatives

Every chart block contains:

1. A visible title that names the measure and dimension.
2. A caption or summary with units, series names, time window, display timezone and active filter scope.
3. An accessible data table or summary disclosure. The table has column and row headers, units, missing counts and the same values as the visual marks.
4. A legend with series names and non-color pattern or marker cues.
5. Keyboard access to marks or a keyboard-accessible table when marks are interactive. A chart canvas that only supports hover is not sufficient.

The summary states null and missing values explicitly. A null value is "not available", not zero. An empty result states that no rows matched rather than showing a zero axis. A partial result names returned and total counts. A comparison chart labels primary and reference and gives unavailable delta reasons such as reference zero, primary null or missing key.

Interactive chart elements have accessible names. For example: "Mathematics proficiency, fall 2026, 68 percent, comparison 62 percent, delta plus 6 percentage points." The data table provides the same information without requiring color or pointer precision.

## 9. Reduced motion

The token layer collapses all duration tokens to 0.01 ms under `prefers-reduced-motion: reduce`, and scoped animation, transition and smooth scrolling are disabled. The design also provides a visible chart animation control where an animation would otherwise run for more than five seconds. The control stops the animation and shows the final state.

Reduced-motion mode still communicates loading and status: a static skeleton remains visible, status text updates, and charts appear in their final state. No essential information is conveyed only by movement.

## 10. Reflow at 320 px and 200 percent zoom

The manual reflow check uses current stable Chromium at:

- 320 by 800 CSS px with device scale factor 1.
- 390 by 844 CSS px for a common narrow phone.
- A 1440 by 900 viewport at 200 percent zoom, equivalent to 720 CSS px.
- A 1280 by 800 viewport at 200 percent zoom, equivalent to 640 CSS px.

Both 640 and 720 CSS px are below the 768 px narrow threshold and use the narrow composition: filter summary and drawer, stacked blocks, and a drawer-based inspector. A docked inspector is not required at these widths.

Pass conditions:

- No horizontal scrolling of the page or board root.
- No control, chart or table content clipped or overlapped.
- The board title, mode, filters, block titles, chart summary and data table access remain available.
- Dialogs and drawers fit within the visual viewport and can be scrolled internally.
- Focus is never moved off-screen by a sticky header or drawer.
- Tables scroll only inside their own labelled region and expose a visible affordance.
- Every horizontally scrollable table container is a named region with `tabindex="0"` and an accessible caption, so a keyboard user can focus and scroll it without trapping the page.
- Text remains at least 12 CSS px at default zoom; at 200 percent the user's zoom is respected and no fixed pixel width prevents reflow.

## 11. Contrast and non-text checks

The design uses the token pairs and ratios in `DESIGN_SYSTEM.md`. The implementation check must additionally verify:

- Every text style against its actual rendered background, including overlays and selected rows.
- Focus rings against the adjacent background, not only the component fill.
- Control boundaries against the surface when the boundary is the only visual cue.
- Chart series against the chart surface; where a pattern is used, the pattern remains visible at 200 percent zoom.
- Status icons and labels against their tinted surfaces.
- Disabled text is exempt from AA contrast but must still be recognizable as disabled; it is never used for essential instructions.

## 12. Manual and automated verification plan

T18 and later UI tasks must record:

1. An axe run on the real viewer, editor, state gallery routes and narrow layouts with zero critical and zero serious findings. Axe results alone do not pass the task.
2. A manual keyboard-only run of every flow in section 4, with focus visible and focus never lost.
3. A screen-reader spot check of landmarks, names, table navigation, live announcements, dialog focus and chart alternatives.
4. Contrast measurements from rendered pixels or computed styles for the token pairs that are actually in use.
5. 320 px and 200 percent zoom reflow checks with screenshots and a written result.
6. Reduced-motion checks with the operating-system preference set before page load.
7. A note of what was not verified, including browser, screen reader, locale and assistive-technology limitations.

The static references in this directory can guide the review, but they are not evidence of a passing production audit.
